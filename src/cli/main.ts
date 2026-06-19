import { createBootstrappedControlPlane } from "../core/bootstrap.js";
import { createCli } from "./program.js";

const plane = await createBootstrappedControlPlane();
const program = createCli({ plane });

try {
  await program.parseAsync(process.argv);
} finally {
  await plane.close();
}
