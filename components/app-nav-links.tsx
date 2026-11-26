"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Enlaces del shell; marca la ruta actual (o una subruta, como
 * `/explorar/<id>`) con `aria-current="page"`. Se reparten en varias líneas
 * en pantallas estrechas, sin scroll horizontal.
 */
export function AppNavLinks({
  links,
}: {
  links: ReadonlyArray<{ href: string; label: string }>;
}) {
  const pathname = usePathname();
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
      {links.map((link) => {
        const current = pathname === link.href || pathname.startsWith(`${link.href}/`);
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
