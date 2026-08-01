import Link from "next/link";

export default function NotFound() {
  return (
    <main className="route-error-page">
      <div className="logo-mark" aria-hidden="true"><span /><span /><span /></div>
      <p className="section-kicker">404 / Research route</p>
      <h1>This workspace does not exist</h1>
      <p>The address is not part of the terminal&apos;s supported research workflow.</p>
      <Link className="command-button" href="/home">Return to market map</Link>
    </main>
  );
}
