export namespace main {
	
	export class ChatResponse {
	    id: string;
	    reply: string;
	    summary: string;
	    actions: string[];
	
	    static createFrom(source: any = {}) {
	        return new ChatResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.reply = source["reply"];
	        this.summary = source["summary"];
	        this.actions = source["actions"];
	    }
	}

}

