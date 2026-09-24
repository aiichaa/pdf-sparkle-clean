// The ESM browser build of tesseract.js default-exports the same API as the package.
declare module "tesseract.js/dist/tesseract.esm.min.js" {
  import Tesseract from "tesseract.js";
  export default Tesseract;
}
