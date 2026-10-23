// Contact verification for customer profiles: a 6-digit code is delivered to
// the channel being verified (email via SMTP, mobile number via WhatsApp) and
// confirmed from the profile page. The dairy/admin can also trigger the same
// flow as a "please verify" request, which adds an in-app notification.
const crypto = require('crypto');
const { VerificationOtp, Customer } = require('./models');
const { AppError } = require('./domain');
const { otpHash, sendVerificationEmail } = require('./auth');
const { createNotification } = require('./notifications');
const whatsapp = require('./whatsapp');

const CHANNEL_LABEL = { email: 'email address', phone: 'mobile number' };
const devOtp = () => process.env.NODE_ENV === 'development' && process.env.DEV_SHOW_OTP === 'true';

async function issueVerification(customer, channel) {
  const target = channel === 'phone' ? customer.phone : customer.email;
  if (!target) {
    throw new AppError(400, 'VERIFICATION_TARGET_MISSING', channel === 'phone'
      ? 'This profile has no mobile number to verify. Ask the dairy to add one first.'
      : 'This profile has no email address to verify.');
  }
  const otp = String(crypto.randomInt(100000, 1000000));
  const hash = otpHash(otp);
  await VerificationOtp.findOneAndUpdate(
    { customer_id: customer._id, channel },
    { customer_id: customer._id, milkman_id: customer.milkman_id, channel, target, hash, attempts: 0, expiry: new Date(Date.now() + 10 * 60000) },
    { upsert: true }
  );
  const dev = devOtp();
  if (!dev) {
    try {
      if (channel === 'phone') {
        await whatsapp.sendText(target, `Your GauAmrut verification code is ${otp}. It expires in 10 minutes. Enter it on your profile under "Verify mobile number".`);
      } else {
        await sendVerificationEmail(target, otp, 'verify');
      }
    } catch (error) {
      await VerificationOtp.deleteOne({ customer_id: customer._id, channel, hash });
      if (error instanceof AppError) throw error;
      throw channel === 'phone'
        ? new AppError(503, 'WHATSAPP_UNAVAILABLE', 'WhatsApp could not send the code. Please retry later.')
        : new AppError(503, 'EMAIL_UNAVAILABLE', 'Verification code could not be sent. Please retry.');
    }
  }
  return { message: `Verification code sent to your ${CHANNEL_LABEL[channel]}.`, ...(dev ? { developmentOtp: otp } : {}) };
}

// The attempt counter must survive failed guesses, so the +1 happens outside
// any transaction (a throw inside withTransaction would roll it back).
async function confirmVerification(customer, channel, otp) {
  const candidate = await VerificationOtp.findOneAndUpdate(
    { customer_id: customer._id, channel, expiry: { $gt: new Date() }, attempts: { $lt: 5 } },
    { $inc: { attempts: 1 } },
    { new: true }
  ).select('+hash');
  if (!candidate || !crypto.timingSafeEqual(Buffer.from(candidate.hash), Buffer.from(otpHash(otp)))) {
    throw new AppError(400, 'INVALID_OTP', 'Code is incorrect, expired, or has reached its attempt limit.');
  }
  const consumed = await VerificationOtp.findOneAndDelete({ _id: candidate._id, hash: candidate.hash });
  if (!consumed) throw new AppError(409, 'OTP_CONSUMED', 'This code has already been used or replaced.');
  const field = channel === 'phone' ? 'phoneVerifiedAt' : 'emailVerifiedAt';
  const verifiedAt = new Date();
  await Customer.updateOne({ _id: customer._id, milkman_id: customer.milkman_id }, { $set: { [field]: verifiedAt } });
  return { channel, target: consumed.target, verifiedAt: verifiedAt.toISOString() };
}

// Admin/dairy triggered nudge: sends fresh codes for the requested channels and
// notifies the customer in-app where to enter them.
async function sendVerificationRequest(customer, user, channels) {
  const requested = [...new Set(channels)];
  const delivered = [], skipped = [];
  for (const channel of requested) {
    if (!user) { skipped.push({ channel, reason: 'NO_ACCOUNT' }); continue; }
    if (!customer[channel === 'phone' ? 'phone' : 'email']) { skipped.push({ channel, reason: channel === 'phone' ? 'NO_MOBILE' : 'NO_EMAIL' }); continue; }
    try {
      await issueVerification(customer, channel);
      delivered.push(channel);
    } catch (error) {
      skipped.push({ channel, reason: error.code || 'SEND_FAILED' });
    }
  }
  if (delivered.length && user) {
    const labels = delivered.map(c => CHANNEL_LABEL[c]).join(' and ');
    await createNotification({
      recipient: user._id,
      role: 'customer',
      tenant: customer.milkman_id,
      type: 'verification',
      title: 'Verify your contact details',
      message: `Your dairy asked you to verify your ${labels}. Enter the code we just sent on your profile page.`,
      link: '/profile',
      relatedId: customer._id
    });
  }
  return { requested, delivered, skipped };
}

module.exports = { issueVerification, confirmVerification, sendVerificationRequest, CHANNEL_LABEL };
