module.exports = {
  apps: [
    {
      name: "rtrl-backend",
      script: "./backend/server.js",
      cwd: "./backend/",
    },
    {
      name: "rtrl-tunnel",
      script: "./start_tunnel.bat",
      interpreter: "cmd",
    },
  ],
};
