/** @type {import('next').NextConfig} */
const enableProdSourceMaps = process.env.NEXT_PUBLIC_PROD_SOURCEMAPS === '1' || process.env.PROD_SOURCEMAPS === '1'

const nextConfig = {
  reactStrictMode: true,
  productionBrowserSourceMaps: Boolean(enableProdSourceMaps),
  transpilePackages: ['@excalidraw/excalidraw'],
  turbopack: {
    root: __dirname
  }
}

module.exports = nextConfig
