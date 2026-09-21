export const channelFor=(provider,model)=>provider.modelChannels?.[model]==='metered'?'metered':'subscription';
export const credentialFor=(provider,model,channel)=>((channel||channelFor(provider,model))==='metered'?provider.meteredSecret:provider.secret);
export const hasCredential=provider=>!!credentialFor(provider,provider.model);
