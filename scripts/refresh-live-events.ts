import { refreshLiveEvents } from "@/lib/events/service";

const result = await refreshLiveEvents();
console.log(JSON.stringify(result, null, 2));

