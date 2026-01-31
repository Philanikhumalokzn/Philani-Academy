declare module 'pdfjs-dist/legacy/build/pdf' {
  const pdfjs: any
  export default pdfjs
  export const version: string
  export const GlobalWorkerOptions: { workerSrc: string }
  export const getDocument: (src: any) => any
}

declare module 'pdfjs-dist/build/pdf.mjs' {
  const pdfjs: any
  export default pdfjs
  export const version: string
  export const GlobalWorkerOptions: { workerSrc: string }
  export const getDocument: (src: any) => any
}
