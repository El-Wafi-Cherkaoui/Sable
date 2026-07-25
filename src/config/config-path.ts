import path from "node:path";
import envPaths from "env-paths";
import { product } from "../shared/product.js";

export const configFileName = "workspaces.json";

export type ConfigPaths = {
  directory: string;
  file: string;
};

export type ResolveConfigPathsOptions = {
  directory?: string;
};

export function resolveConfigPaths(
  options: ResolveConfigPathsOptions = {},
): ConfigPaths {
  const directory =
    options.directory ?? envPaths(product.configDirectoryName).config;

  return {
    directory,
    file: path.join(directory, configFileName),
  };
}
