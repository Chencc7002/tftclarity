export const STATS_PROVIDER_CAPABILITIES = Object.freeze(["catalog", "comp_rankings", "unit_builds", "patch_status"]);

export class StatsProviderError extends Error {
  constructor(message, options = {}) { super(message); this.name="StatsProviderError"; this.code=options.code??"stats_provider_error"; this.provider=options.provider??null; this.capability=options.capability??null; }
}

export class StatsProvider {
  constructor(options = {}) { if(!options.id||!options.version)throw new TypeError("StatsProvider requires id and version");this.id=String(options.id);this.version=String(options.version); }
  getAvailability(){return{available:true,provider:this.id,providerVersion:this.version};}
  getCatalog(){throw this.notImplemented("catalog");} getCompRankings(){throw this.notImplemented("comp_rankings");}
  getUnitBuilds(){throw this.notImplemented("unit_builds");} getPatchStatus(){throw this.notImplemented("patch_status");}
  notImplemented(capability){return new StatsProviderError(`${this.id}.${capability} is not implemented`,{code:"provider_capability_not_implemented",provider:this.id,capability});}
  envelope(data,context={},details={}){return{data,provenance:{provider:this.id,providerVersion:this.version,seasonContextId:context.id??context.seasonContextId??"set17-live",effectivePatch:details.effectivePatch??context.source?.currentPatch??context.patch??"current",region:details.region??context.region??null,queue:String(details.queue??context.source?.queue??context.queue??"1100"),fetchedAt:details.fetchedAt??new Date().toISOString(),sourceRequestId:details.sourceRequestId??null}};}
}

export class CapabilityProviderRouter {
  constructor(options={}){this.providers=new Map(Object.entries(options.providers??{}));this.capabilities={...(options.capabilities??{})};this.fallback=options.fallback===true;}
  providerFor(capability){const id=this.capabilities[capability];const provider=this.providers.get(id);if(!provider)throw new StatsProviderError(`No provider configured for ${capability}`,{code:"provider_capability_unavailable",provider:id,capability});return provider;}
  async call(capability,context,query){const provider=this.providerFor(capability);const method={catalog:"getCatalog",comp_rankings:"getCompRankings",unit_builds:"getUnitBuilds",patch_status:"getPatchStatus"}[capability];return provider[method](context,query);}
}
