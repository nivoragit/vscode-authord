// @ts-check

import path from 'path';
import { fileURLToPath } from 'url';

/** @typedef {import('webpack').Configuration} WebpackConfig */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type WebpackConfig */
const extensionConfig = {
  // Ensure the build is compatible with Node.js
  target: 'node',

  // Keep source code readable in development mode
  mode: 'none',

  // Entry point for the extension
  entry: './src/extension.ts',

  // Output settings for the compiled bundle
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2', // Required for VS Code extensions
    clean: true, // Cleans the output directory before every build
  },

  // Exclude `vscode` and other modules from being bundled
  externals: {
    vscode: 'commonjs vscode',
  },

  resolve: {
    // Specify which file extensions Webpack should resolve
    extensions: ['.ts', '.js'],
    extensionAlias: {
      '.js': ['.ts', '.js'],
    },
  },

  module: {
    // Rules to handle TypeScript files
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader', // Compiles TypeScript to JavaScript
          },
        ],
      },
    ],
  },

  // Generate a source map for easier debugging
  devtool: 'nosources-source-map',

  infrastructureLogging: {
    level: 'log', // Enables detailed logging during the build
  },

  stats: 'errors-only', // Show only errors in the console
};

export default [extensionConfig];
