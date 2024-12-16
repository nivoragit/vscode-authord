const path = require('path');

module.exports = {
  mode: 'development',
  target: 'node',
  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2', // Ensure CommonJS output
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        loader: 'esbuild-loader',
        options: {
          loader: 'ts',
          target: 'esnext',
        },
      },
    ],
  },
  externals: {
    vscode: 'commonjs vscode', // VS Code API remains external
  },
  devtool: 'source-map',
};
