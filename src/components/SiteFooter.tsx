import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-[#eceef4] bg-[#fafbfd]">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-4 px-4 py-8 text-sm text-[#6b7280] sm:flex-row sm:items-center">
        <p className="font-medium text-[#374151]">© {new Date().getFullYear()} AI Vectorizer</p>
        <nav className="flex flex-wrap gap-5">
          <Link href="/pricing" className="hover:text-[#3b5bfd]">
            Pricing
          </Link>
          <Link href="/developers" className="hover:text-[#3b5bfd]">
            Developers & API
          </Link>
          <Link href="/support" className="hover:text-[#3b5bfd]">
            Support
          </Link>
          <Link href="/dashboard" className="hover:text-[#3b5bfd]">
            Dashboard
          </Link>
          <a href="/api/health" className="hover:text-[#3b5bfd]">
            Status
          </a>
        </nav>
        <p className="sm:ml-auto">SVG · EPS · PDF · DXF export engine · hybrid potrace + k-means pipeline</p>
      </div>
    </footer>
  );
}
