
const { permissionsFor } = require('./admin-permissions');
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { User, Milkman, Otp } = require('./models');
const { AppError } = require('./domain');
const { wrap, validate, auth } = require('./middleware');
const schema = require('./validation');
const {
  resolveDairy,
  beginOnboarding,
  completeOnboarding
} = require('./onboarding');
const { platformSettings } = require('./settings');

const normalize = email => email.trim().toLowerCase();

const otpHash = otp =>
  crypto
    .createHmac('sha256', process.env.JWT_SECRET)
    .update(otp)
    .digest('hex');

async function identity(user) {
  if (user.role === 'admin') {
    return {
      id: user._id,
      name: user.name,
      email: user.email,
      role: 'admin',
      adminRole: user.adminRole,
      permissions: permissionsFor(user),
      businessName: 'GauAmrut administration'
    };
  }

  const profile = await Milkman.findById(user.milkman_id).lean();

  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    milkman_id: user.milkman_id,
    customer_id: user.customer_id,
    businessName: profile?.businessName,
    code: user.role === 'milkman' ? profile?.code : undefined
  };
}

async function sessionData(user) {
  return {
    token: jwt.sign(
      { sv: user.sessionVersion || 0 },
      process.env.JWT_SECRET,
      {
        subject: String(user._id),
        issuer: 'gauamrut',
        algorithm: 'HS256',
        expiresIn: '8h'
      }
    ),
    user: await identity(user)
  };
}

// Send OTP emails using Brevo's HTTPS API instead of SMTP.
async function sendVerificationEmail(email, otp, purpose = 'register') {
  const { BREVO_API_KEY, BREVO_FROM_EMAIL } = process.env;

  if (!BREVO_API_KEY || !BREVO_FROM_EMAIL) {
    console.error(JSON.stringify({
      event: 'otp_email_skipped',
      reason: 'Brevo email delivery is not configured'
    }));

    throw new AppError(
      503,
      'EMAIL_UNAVAILABLE',
      'Email delivery is not configured.'
    );
  }

  const verifying = purpose !== 'register';

  const subject = verifying
    ? 'Verify your GauAmrut contact details'
    : 'Verify your GauAmrut account';

  const lead = verifying
    ? 'Use the code below to verify the email address on your GauAmrut profile. It expires in 10 minutes.'
    : 'Use the code below to finish creating your account. It expires in 10 minutes.';

  const text =
    `Your GauAmrut verification code is ${otp}. ` +
    'It expires in 10 minutes.\n\n' +
    'If you did not request this code, you can safely ignore this email.';

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px">
      <h2 style="margin:0 0 8px;color:#166534">${subject}</h2>
      <p style="color:#374151;margin:0 0 16px">${lead}</p>
      <p style="font-size:32px;letter-spacing:10px;font-weight:bold;margin:0 0 16px;color:#111827">${otp}</p>
      <p style="color:#6b7280;font-size:13px;margin:0">
        If you did not request this code, you can safely ignore this email.
      </p>
    </div>
  `;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(
      'https://api.brevo.com/v3/smtp/email',
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'api-key': BREVO_API_KEY,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          sender: {
            name: 'GauAmrut',
            email: BREVO_FROM_EMAIL
          },
          to: [{ email }],
          subject,
          textContent: text,
          htmlContent: html
        })
      }
    );

    if (!response.ok) {
      console.error(JSON.stringify({
        event: 'otp_email_failed',
        provider: 'brevo',
        status: response.status
      }));

      throw new AppError(
        503,
        'EMAIL_UNAVAILABLE',
        'Verification email could not be sent.'
      );
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    console.error(JSON.stringify({
      event: 'otp_email_failed',
      provider: 'brevo',
      error: error.name
    }));

    throw new AppError(
      503,
      'EMAIL_UNAVAILABLE',
      'Verification email could not be sent.'
    );
  } finally {
    clearTimeout(timeout);
  }
}

function authRoutes(limiter) {
  const router = express.Router();

  const issue = async (req, res, customer = false) => {
    const email = normalize(req.body.email);

    if (await User.exists({ email })) {
      throw new AppError(
        409,
        'ACCOUNT_EXISTS',
        'An account already exists for this email.'
      );
    }

    if (!customer && !(await platformSettings()).registration.open) {
      throw new AppError(
        403,
        'REGISTRATION_CLOSED',
        'New dairy sign-ups are currently closed. Please contact GauAmrut support to open your account.'
      );
    }

    const otp = String(crypto.randomInt(100000, 1000000));

    const dairy = customer
      ? await resolveDairy(req.body.code)
      : null;

    const registration = {
      ...req.body,
      email,
      password: await bcrypt.hash(req.body.password, 12),
      role: customer ? 'customer' : 'milkman',
      ...(dairy
        ? {
            milkman_id: String(dairy._id),
            code: dairy.code
          }
        : {})
    };

    const hash = otpHash(otp);

    await Otp.findOneAndUpdate(
      { email },
      {
        hash,
        registration,
        attempts: 0,
        expiry: new Date(Date.now() + 10 * 60000)
      },
      { upsert: true }
    );

    const dev =
      process.env.NODE_ENV === 'development' &&
      process.env.DEV_SHOW_OTP === 'true';

    if (!dev) {
      try {
        await sendVerificationEmail(email, otp);
      } catch (error) {
        await Otp.deleteOne({ email, hash });

        if (error instanceof AppError) {
          throw error;
        }

        throw new AppError(
          503,
          'EMAIL_UNAVAILABLE',
          'Verification email could not be sent. Please retry registration.'
        );
      }
    }

    res.status(202).json({
      success: true,
      data: {
        message: 'Verification code sent.',
        ...(dev ? { developmentOtp: otp } : {})
      }
    });
  };

  router.post(
    '/register',
    limiter,
    validate(schema.register),
    wrap((req, res) => issue(req, res))
  );

  router.post(
    '/customer/register',
    limiter,
    validate(schema.customerRegister),
    wrap((req, res) => issue(req, res, true))
  );

  router.post(
    '/dairy/resolve',
    limiter,
    validate(
      schema.Joi.object({
        code: schema.code.required()
      })
    ),
    wrap(async (req, res) => {
      const dairy = await resolveDairy(req.body.code);

      res.json({
        success: true,
        data: {
          businessName: dairy.businessName,
          code: dairy.code
        }
      });
    })
  );

  router.post(
    '/customer/complete',
    limiter,
    validate(schema.customerComplete),
    wrap(async (req, res) => {
      const user = await completeOnboarding(
        req.body,
        req.requestId
      );

      res.status(201).json({
        success: true,
        data: await sessionData(user)
      });
    })
  );

  router.post(
    '/verify',
    limiter,
    validate(schema.verify),
    wrap(async (req, res) => {
      const email = normalize(req.body.email);

      const candidate = await Otp.findOneAndUpdate(
        {
          email,
          expiry: { $gt: new Date() },
          attempts: { $lt: 5 }
        },
        { $inc: { attempts: 1 } },
        { new: true }
      ).select('+hash +registration');

      if (
        !candidate ||
        !crypto.timingSafeEqual(
          Buffer.from(candidate.hash),
          Buffer.from(otpHash(req.body.otp))
        )
      ) {
        throw new AppError(
          400,
          'INVALID_OTP',
          'Code is incorrect, expired, or has reached its attempt limit.'
        );
      }

      if (
        candidate.registration.role !== 'customer' &&
        !(await platformSettings()).registration.open
      ) {
        throw new AppError(
          403,
          'REGISTRATION_CLOSED',
          'New dairy sign-ups are currently closed. Please contact GauAmrut support to open your account.'
        );
      }

      const session = await mongoose.startSession();

      let user;
      let onboarding;

      try {
        await session.withTransaction(async () => {
          const consumed = await Otp.findOneAndDelete({
            _id: candidate._id,
            hash: candidate.hash,
            expiry: { $gt: new Date() }
          })
            .session(session)
            .select('+registration');

          if (!consumed) {
            throw new AppError(
              409,
              'OTP_CONSUMED',
              'This code has already been used or replaced.'
            );
          }

          if (consumed.registration.role === 'customer') {
            onboarding = await beginOnboarding(
              consumed.registration,
              session
            );
            return;
          }

          const milkman_id = new mongoose.Types.ObjectId();

          const {
            name,
            password,
            businessName,
            phone
          } = consumed.registration;

          [user] = await User.create(
            [{
              email,
              password,
              name,
              role: 'milkman',
              milkman_id
            }],
            { session }
          );

          await Milkman.create(
            [{
              _id: milkman_id,
              user_id: user._id,
              name,
              businessName,
              phone,
              code: crypto
                .randomBytes(6)
                .toString('hex')
                .slice(0, 8)
                .toUpperCase()
            }],
            { session }
          );
        });
      } finally {
        await session.endSession();
      }

      res.status(201).json({
        success: true,
        data: onboarding || await sessionData(user)
      });
    })
  );

  router.post(
    '/login',
    limiter,
    validate(schema.login),
    wrap(async (req, res) => {
      const user = await User.findOne({
        email: normalize(req.body.email)
      }).select('+password +sessionVersion');

      if (
        !user ||
        !user.active ||
        !(await bcrypt.compare(req.body.password, user.password))
      ) {
        throw new AppError(
          401,
          'INVALID_CREDENTIALS',
          'Email or password is incorrect.'
        );
      }

      res.json({
        success: true,
        data: await sessionData(user)
      });
    })
  );

  router.get(
    '/me',
    auth,
    wrap(async (req, res) => {
      res.json({
        success: true,
        data: await identity(req.user)
      });
    })
  );

  router.post(
    '/logout',
    auth,
    wrap(async (req, res) => {
      await User.updateOne(
        { _id: req.user._id },
        { $inc: { sessionVersion: 1 } }
      );

      res.json({
        success: true,
        data: {
          message: 'All current sessions have been signed out.'
        }
      });
    })
  );

  return router;
}

module.exports = {
  authRoutes,
  otpHash,
  sendVerificationEmail
};
