module.exports = {
  apps: [
    {
      name: "rtrl-backend",
      script: "./backend/server.js",
      cwd: "./backend/",
      node_args: "--max-old-space-size=512",
    },
    {
      name: "rtrl-tunnel",
      script: "./start_tunnel.bat",
      interpreter: "cmd",
    },
  ],
};
