import knex from "knex";
import { DATABASE_URL } from "./utility/constants.js";

export default knex({
	client: "pg",
	connection: DATABASE_URL,
	pool: { min: 0 },
});
