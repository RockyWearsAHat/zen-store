import typescript from "@rollup/plugin-typescript";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import gzipPlugin from "rollup-plugin-gzip";

import { glob } from "glob";
import { extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";
import { copyFile } from "./copyFile.js";
import MagicString from "magic-string";

function rewriteGzipImports() {
  // match dynamic imports with .js but not .gz.js
  const patternDImport = new RegExp(/"\.\/([\w\-.]+)\.js(?<!\.gz\.js)"/, "mg");
  return {
    name: "rewriteImports",
    renderChunk(code) {
      const magicString = new MagicString(code);
      let hasReplacements = false;
      let match;
      let start;
      let end;
      let replacement;

      function replaceImport() {
        hasReplacements = true;
        start = match.index + 3;
        end = start + match[1].length;
        replacement = String(match[1].replace(match[1], match[1] + ".gz"));
        magicString.overwrite(start, end, replacement);
      }

      // work against dynamic imports
      while ((match = patternDImport.exec(code))) {
        replaceImport();
      }

      if (!hasReplacements) {
        return null;
      }
      return { code: magicString.toString() };
    },
  };
}

export default [
  {
    input: Object.fromEntries(
      glob
        .sync(
          [
            "*.ts",
            "api/**/*.ts",
            "db/*.ts",
            "db/**/*.ts",
            "server/**/*.ts",
            "server/*.ts",
          ],
          {
            ignore: ["**/*.d.ts", "**/*.test.ts"],
          }
        )
        .map((file) => [
          file.slice(0, file.length - extname(file).length),
          fileURLToPath(new URL(file, import.meta.url)),
        ])
    ),
    output: {
      dir: "dist",
      format: "esm",
      sourcemap: true,
      preserveModules: true,
      preserveModulesRoot: ".",
    },
    external(id) {
      return id.includes(sep + "node_modules" + sep);
    },
    plugins: [
      typescript({ moduleResolution: "bundler" }),
      resolve({ preferBuiltins: true, jsnext: true, main: true }),
      commonjs({ ignoreDynamicRequires: true, ignore: builtinModules }),
      copyFile("robots.txt", "dist/robots.txt"),
      gzipPlugin(),
      rewriteGzipImports(),
    ],
  },
];
