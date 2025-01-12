import { API } from "@discordjs/core";
import { REST } from "@discordjs/rest";

export const discord = new API(new REST({ version: "10" }));
