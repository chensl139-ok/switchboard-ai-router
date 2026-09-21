export type CredentialChannel = 'subscription' | 'metered';

export interface ProviderCredentialConfig {
 model: string;
 modelChannels?: Record<string, CredentialChannel>;
 secret?: string;
 meteredSecret?: string;
}

export function channelFor(provider: ProviderCredentialConfig, model: string): CredentialChannel {
 return provider.modelChannels?.[model] === 'metered' ? 'metered' : 'subscription';
}

export function credentialFor(provider: ProviderCredentialConfig, model: string, channel?: CredentialChannel): string | undefined {
 return (channel ?? channelFor(provider, model)) === 'metered' ? provider.meteredSecret : provider.secret;
}

export function hasCredential(provider: ProviderCredentialConfig): boolean {
 return Boolean(credentialFor(provider, provider.model));
}
