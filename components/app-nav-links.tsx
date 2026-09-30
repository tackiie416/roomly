"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Enlaces del shell; marca la ruta actual con `aria-current="page"`. */
export function AppNavLinks({
  links,
}: {
  links: ReadonlyArray<{ href: string; label: string }>;
}) {
  const pathname = usePathname();
  return (
    <ul className="flex gap-4 text-sm">
      {links.map((link) => {
        const current = pathname === link.href;
        return (
          <li key={link.href}>
            <Link
              href={link.href}
              aria-current={current ? "page" : undefined}
              className={
                current
                  ? "font-medium underline"
                  : "text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
              }
            >
              {link.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
