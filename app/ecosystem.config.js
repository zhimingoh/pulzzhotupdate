module.exports = {
  apps: [
    {
      name: "pulzz-hotupdate",
      cwd: process.env.PM2_CWD || "/opt/pulzz-hotupdate/app",
      script: "src/server.js",
      interpreter: "node",
      env: {
        NODE_ENV: process.env.NODE_ENV || "production",
        HOST: process.env.HOST || "127.0.0.1",
        PORT: process.env.PORT || "20808",
        PULZZ_STATE_PATH: process.env.PULZZ_STATE_PATH || "/opt/pulzz-hotupdate/data/state.json",
        HOTUPDATE_MANIFEST_URL: process.env.HOTUPDATE_MANIFEST_URL || "https://cdn.example.com/hotupdate/latest.json"
      }
    }
  ]
};
