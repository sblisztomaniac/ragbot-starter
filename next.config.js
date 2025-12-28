module.exports = {
  output: 'standalone', // Optimize for serverless deployment (reduces bundle size)
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Externalize packages to reduce serverless function size
      config.externals = config.externals || [];
      config.externals.push({
        '@xenova/transformers': 'commonjs @xenova/transformers',
        'onnxruntime-node': 'commonjs onnxruntime-node',
        'sharp': 'commonjs sharp',
        // Externalize unused packages (safe - using HTTP API instead)
        'langchain': 'commonjs langchain',
        'ainative-zerodb-mcp-server': 'commonjs ainative-zerodb-mcp-server'
      });
    }

    // Ignore .node files
    config.module.rules.push({
      test: /\.node$/,
      use: 'node-loader',
    });

    return config;
  },
  experimental: {
    serverComponentsExternalPackages: ['@xenova/transformers', 'onnxruntime-node', 'sharp']
  }
}