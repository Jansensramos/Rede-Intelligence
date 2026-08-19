import os from "node:os";

try {
  os.userInfo();
} catch {
  os.userInfo = () => ({
    username: process.env.USERNAME ?? "rede",
    uid: -1,
    gid: -1,
    shell: null,
    homedir: process.cwd(),
  });
}
