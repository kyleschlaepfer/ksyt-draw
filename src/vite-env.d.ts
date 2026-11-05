/// <reference types="vite/client" />
declare module "*.woff2?inline" {
  const dataUrl: string;
  export default dataUrl;
}
declare module "*.woff?inline" {
  const dataUrl: string;
  export default dataUrl;
}
declare module "*.html?raw" {
  const html: string;
  export default html;
}
declare module "*.svg?raw" {
  const svg: string;
  export default svg;
}
