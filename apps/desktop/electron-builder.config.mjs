import { product, PRODUCT_BUILD_ID } from "@spiritagent/product";

export default {
  extends: "./electron-builder.yml",
  productName: product.name,
  artifactName: `${product.name}-Desktop-\${version}-\${os}-\${arch}.\${ext}`,
  mac: {
    artifactName: `${product.name}-Desktop-\${version}-darwin-\${arch}.\${ext}`,
    ...(process.env.SPIRIT_MACOS_ENTITLEMENTS
      ? {
          entitlements: process.env.SPIRIT_MACOS_ENTITLEMENTS,
          entitlementsInherit: process.env.SPIRIT_MACOS_ENTITLEMENTS,
        }
      : {}),
  },
  protocols: [{ name: product.name, schemes: [product.urlProtocol] }],
  extraMetadata: {
    description: `Desktop application for ${product.name}`,
    homepage: product.websiteOrigin,
    productBuildId: PRODUCT_BUILD_ID,
  },
};
