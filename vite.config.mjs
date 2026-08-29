import { defineConfig } from "vite";

const deployBasePath = process.env.DEPLOY_BASE_PATH || "/";

export default defineConfig({
    base: deployBasePath
});
