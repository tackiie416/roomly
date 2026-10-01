// Configuración compartida del E2E local (E1): el Supabase simulado, la app
// y los specs. Ningún valor es un secreto: la clave anon es ficticia y solo
// la acepta el mock.
export const MOCK_SUPABASE_PORT = 54329;
export const MOCK_SUPABASE_URL = `http://127.0.0.1:${MOCK_SUPABASE_PORT}`;
export const MOCK_ANON_KEY = "e1-mock-anon-key-no-es-un-secreto";
export const APP_ORIGIN = "http://localhost:3000";
