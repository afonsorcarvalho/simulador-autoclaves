/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@sim/physics', '@sim/protocol'],
};

export default nextConfig;
