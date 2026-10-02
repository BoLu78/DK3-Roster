import * as pdfjs from '../vendor/pdfjs/pdf.min.mjs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(fileURLToPath(new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url))).href;

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export { pdfjs };
