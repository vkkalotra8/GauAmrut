import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Droplets, Leaf } from 'lucide-react';
import { api, message, preview, signIn } from '../../lib';
import { Brand, Field, Notice } from '../../components/ui';
export default function Auth({ redirectPath = '/' }) {
  const dispatch = useDispatch(); const navigate = useNavigate();
  const [mode, setMode] = useState('login'), [email, setEmail] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [otp, setOtp] = useState(''), [dairy, setDairy] = useState(null), [onboarding, setOnboarding] = useState(null);
  const reset = next => { setMode(next); setError(''); setOtp(''); setOnboarding(null); };
  const enter = data => { dispatch(signIn(data)); navigate(redirectPath.startsWith('/') ? redirectPath : '/', { replace: true }); };
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    const body = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (mode === 'resolve') { const r = await api.post('/auth/dairy/resolve', body); setDairy(r.data.data); setMode('customer'); }
      else if (mode === 'register' || mode === 'customer') {
        const r = await api.post(mode === 'register' ? '/auth/register' : '/auth/customer/register', mode === 'customer' ? { ...body, code: dairy.code } : body);
        setEmail(body.email); setOtp(r.data.data.developmentOtp || ''); setMode('verify');
      } else if (mode === 'claim') {
        const r = await api.post('/auth/customer/complete', { onboardingToken: onboarding.onboardingToken, ...(body.history === 'new' ? { createNew: true } : { claimCustomerId: body.history }) }); enter(r.data.data);
      } else {
        const r = await api.post(mode === 'verify' ? '/auth/verify' : '/auth/login', mode === 'verify' ? { email, otp: body.otp } : body);
        if (r.data.data.onboardingRequired) { setOnboarding(r.data.data); setMode('claim'); } else enter(r.data.data);
      }
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const titles = { login: 'Your dairy day starts here.', register: 'Let’s meet your dairy.', resolve: 'Find your dairy.', customer: 'Join your dairy.', verify: 'Check your inbox.', claim: 'Connect your account.' };
  const buttons = { login: 'Sign in', register: 'Create your dairy account', resolve: 'Find dairy', customer: 'Verify my email', verify: 'Verify & get started', claim: 'Confirm & connect' };
  return <div className="auth-layout"><section className="auth-story"><Brand/><div><span className="pill light"><Leaf size={15}/> Fresh starts, every day</span><h1>A little less admin.<br/>A lot more peace<br/>of mind.</h1><p>Your customers, daily deliveries, and payments.<br/>Together in one thoughtfully simple place.</p><div className="milk-illustration"><div className="bottle"><span>GA<br/><small>PURE & FRESH</small><Droplets size={34}/></span></div><div className="orbit orbit-one"/><div className="orbit orbit-two"/><Leaf className="illustration-leaf" size={90}/></div></div><span className="auth-footer">Made for the people who bring goodness to every doorstep.</span></section><section className="auth-panel"><div className="auth-card"><span className="eyebrow">WELCOME TO GAUAMRUT</span><h2>{titles[mode]}</h2><p>{mode === 'verify' ? `Enter the six-digit code sent to ${email}.` : mode === 'resolve' ? 'Enter the eight-character code shared by your milkman.' : 'Simple tools for a better everyday business.'}</p>
    <form onSubmit={submit} key={mode}>
      {mode === 'resolve' && <Field label="Dairy code" name="code" required minLength={8} maxLength={8} autoCapitalize="characters"/>}
      {mode === 'customer' && <Notice>You are joining <strong>{dairy.businessName}</strong>. <button type="button" className="text-button" onClick={() => reset('resolve')}>Choose another dairy</button></Notice>}
      {['register', 'customer'].includes(mode) && <><Field label="Your name" name="name" required minLength={2}/>{mode === 'register' && <Field label="Business name" name="businessName" required minLength={2}/>}<Field label="Phone number" name="phone" type="tel" required/></>}
      {['login', 'register', 'customer'].includes(mode) && <><Field label="Email address" name="email" type="email" autoComplete="email" required/><Field label="Password" name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} maxLength={72} required/></>}
      {mode === 'customer' && <Field label="Delivery address" name="address"/>}
      {mode === 'verify' && <Field label="Verification code" name="otp" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required/>}
      {mode === 'claim' && <><Notice>Email verified. Connect to <strong>{onboarding.businessName}</strong>.</Notice><fieldset className="history-options"><legend>Your delivery history</legend>{onboarding.historyCandidates.map(c => <label key={c._id}><input type="radio" name="history" value={c._id} required/><span>Claim {c.name}’s existing account<small>Service since {c.startDate}. Existing rates, deliveries, and bills stay attached.</small></span></label>)}<label><input type="radio" name="history" value="new" required defaultChecked={!onboarding.historyCandidates.length}/><span>Create a new customer profile<small>Your dairy will set your rates and activate deliveries.</small></span></label></fieldset></>}
      <Notice error>{error}</Notice>{otp && mode === 'verify' && <Notice>Local development code: {otp}</Notice>}<button className="button primary full" disabled={busy}>{busy ? 'Please wait…' : buttons[mode]}<ArrowRight size={18}/></button>
    </form>
    {mode === 'login' ? <><button className="text-button" onClick={() => reset('register')}>New here? Create an account</button><button className="text-button" onClick={() => reset('resolve')}>I’m a customer — join my dairy</button></> : <button className="text-button" onClick={() => reset('login')}>Back to sign in</button>}
    <div className="divider">JUST LOOKING AROUND?</div><button className="button full" onClick={() => dispatch(preview())}>Explore the demo <ArrowUpRight size={17}/></button><small className="muted">Sample data. No account or database needed.</small></div></section></div>;
}
