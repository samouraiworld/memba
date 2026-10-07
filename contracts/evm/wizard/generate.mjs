// Prints the pristine OpenZeppelin Wizard output that src/MembaToken.sol is derived from.
// The name, symbol and premint here are placeholders: MembaToken.patch turns them into constructor parameters.
import { erc20 } from "@openzeppelin/wizard";

process.stdout.write(
  erc20.print({ name: "MembaToken", symbol: "MBT", premint: "1000000", permit: true, votes: "blocknumber" }),
);
