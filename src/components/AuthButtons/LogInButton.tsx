import Link from 'next/link';

// Console style: 32px ghost button — 1px border, flat surface on hover.
const LogInButton: React.FC = () => {
  return (
    <Link
      href="/login"
      className="inline-flex items-center h-8 px-3.5 rounded-[5px] border border-[var(--border)] text-[13px] font-medium text-[var(--text-2)] hover:border-[var(--border-strong)] hover:text-[var(--text)] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
    >
      Log in
    </Link>
  );
};

export default LogInButton;
