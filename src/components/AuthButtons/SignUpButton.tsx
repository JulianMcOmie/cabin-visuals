import Link from 'next/link';

// Console style: solid accent with dark text (the one blue, no glow).
const SignUpButton: React.FC = () => {
  return (
    <Link
      href="/signup"
      className="inline-flex items-center h-8 px-3.5 rounded-[5px] bg-[var(--accent)] text-[13px] font-semibold text-[var(--on-accent)] hover:bg-[var(--accent-hover)] transition-colors cursor-pointer"
    >
      Sign up
    </Link>
  );
};

export default SignUpButton;
