
import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: '/deployments', destination: '/campaigns', permanent: false },
      { source: '/deployments/post', destination: '/campaigns/post', permanent: false },
      { source: '/deployments/:id', destination: '/campaigns/:id', permanent: false },
      { source: '/deployments/:id/edit', destination: '/campaigns/:id/edit', permanent: false },
      { source: '/linkedin-os', destination: '/prism', permanent: true },
      { source: '/linkedin-os/:path*', destination: '/prism/:path*', permanent: true },
    ];
  },
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
