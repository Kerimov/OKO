declare module "pdfmake/build/pdfmake" {
  import type { TDocumentDefinitions } from "pdfmake/interfaces";

  interface PdfDocument {
    download(defaultFileName?: string): void;
    open(): void;
  }

  interface PdfMake {
    vfs?: Record<string, string>;
    createPdf(doc: TDocumentDefinitions): PdfDocument;
  }

  const pdfMake: PdfMake;
  export default pdfMake;
}

declare module "pdfmake/build/vfs_fonts" {
  const vfsFonts: { pdfMake?: { vfs: Record<string, string> } };
  export default vfsFonts;
}
