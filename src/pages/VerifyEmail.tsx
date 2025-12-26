import { getAuth, sendEmailVerification } from 'firebase/auth';

export default function VerifyEmail() {
  const resend = async () => {
    const user = getAuth().currentUser;
    if (user) await sendEmailVerification(user);
  };
  return (
    <div className="max-w-lg mx-auto mt-16 p-6 card text-center">
      <h2 className="text-xl font-semibold mb-2">Verify your email</h2>
      <p className="text-gray-600 mb-4">A verification message was sent to your email.</p>
      <button className="btn-primary" onClick={resend}>Resend</button>
    </div>
  );
}
