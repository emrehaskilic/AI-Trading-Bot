/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PROXY_API_KEY: string;
  readonly VITE_VIEWER_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
