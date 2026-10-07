// Configuración compartida del E2E local (E1): el Supabase simulado, la app
// y los specs. Ningún valor es un secreto: las claves anon y service_role
// son ficticias y solo las acepta el mock (Fase 3: la app usa service_role en
// el servidor para leer candidatos y escribir el test; nunca llega al
// navegador).
export const MOCK_SUPABASE_PORT = 54329;
export const MOCK_SUPABASE_URL = `http://127.0.0.1:${MOCK_SUPABASE_PORT}`;
export const MOCK_ANON_KEY = "e1-mock-anon-key-no-es-un-secreto";
export const MOCK_SERVICE_ROLE_KEY = "e1-mock-service-role-key-no-es-un-secreto";
export const APP_ORIGIN = "http://localhost:3000";
