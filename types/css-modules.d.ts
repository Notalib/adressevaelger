// The component imports its stylesheets as text, which esbuild's css loader
// turns into a string. TypeScript needs telling; without this the imports are
// unresolved modules and the declarations they feed are `any`.
declare module "*.css" {
  const styles: string;
  export default styles;
}
