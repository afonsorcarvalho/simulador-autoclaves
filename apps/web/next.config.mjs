/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@sim/physics', '@sim/protocol'],
  webpack(config) {
    // Server code uses ESM-style `.js` extension imports on `.ts` source files.
    // Webpack needs to know that a `.js` import may resolve to a `.ts` file.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.js'],
    };
    return config;
  },
};

export default nextConfig;
