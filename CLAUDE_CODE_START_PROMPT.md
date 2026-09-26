Pega esto en Claude Code, dentro de `C:\ROOMLY`, después de copiar el
contenido de `ROOMLY_TRANSFER/project/` ahí.

---

Este proyecto es una transferencia completa de ROOMLY desde Claude Chat.

No es un proyecto nuevo. Es la continuación de un proyecto real, con
arquitectura, base de datos, código y documentación ya construidos en
una conversación previa, dentro de un entorno sin acceso de red a
Supabase ni a Playwright. Tu trabajo empieza con una auditoría, no con
programar.

Antes de tocar nada:

1. Lee CLAUDE.md.
2. Lee ROOMLY_MASTER_SPEC.md.
3. Lee HANDOFF.md.
4. Lee PROGRESS.md.
5. Lee docs/ARCHITECTURE.md.
6. Lee docs/DATABASE.md.
7. Lee docs/SECURITY.md.
8. Lee docs/ROADMAP.md.
9. Inspecciona el repositorio real (no asumas que la documentación
   describe correctamente lo que hay en disco).
10. Ejecuta `git status`.
11. Ejecuta `git log`.
12. Inspecciona `package.json`.
13. Inspecciona la estructura de carpetas real.
14. Inspecciona las migraciones en `supabase/migrations/`.
15. Inspecciona los tests en `tests/`.
16. Compara la documentación contra el código real, archivo por archivo
    donde haga falta.
17. Detecta cualquier diferencia entre lo documentado y lo que
    encuentras (node_modules no existe todavía porque no se transfirió
    a propósito — instálalo con `npm install` antes de sacar
    conclusiones sobre si algo falta).
18. NO borres nada.
19. NO empieces automáticamente ninguna fase nueva.
20. NO hagas `git push`.
21. Presenta una auditoría del estado real: qué está commiteado, qué no,
    qué pasa `lint`/`typecheck`/`test`/`build` si lo ejecutas tú mismo
    ahora, qué necesita todavía un proyecto Supabase real y credenciales
    que no tienes.
22. Confirma cuál es, según tu propia auditoría, el siguiente paso
    razonable (probablemente cerrar el checklist de Fase 1 que quedó
    abierto — está detallado en HANDOFF.md).
23. Espera mi autorización explícita antes de continuar con cualquier
    implementación.
