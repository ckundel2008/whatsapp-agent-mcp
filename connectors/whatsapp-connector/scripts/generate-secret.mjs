import { randomBytes } from "node:crypto";
import { existsSync,mkdirSync,writeFileSync } from "node:fs";
import { dirname,resolve } from "node:path";
const output=resolve(process.argv[2]??"secrets/auth_state_key");if(existsSync(output))throw new Error(`Refusing to overwrite ${output}`);mkdirSync(dirname(output),{recursive:true,mode:0o700});writeFileSync(output,randomBytes(32).toString("base64"),{mode:0o600});process.stdout.write(`${output}\n`);
