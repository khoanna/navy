'use client'

import { ChakraProvider } from '@chakra-ui/react'
import { createAppKit } from '@reown/appkit/react'
import { WagmiProvider } from 'wagmi'
import { sepolia, AppKitNetwork } from '@reown/appkit/networks'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { Web3ContextProvider } from '@/context/Web3Context'

const queryClient = new QueryClient()

const projectId = process.env.NEXT_PUBLIC_PROJECT_ID || "";

const metadataWeb3 = {
  name: 'AppKit',
  description: 'AppKit Example',
  url: 'https://example.com',
  icons: ['https://avatars.githubusercontent.com/u/179229932']
}

const networks: [AppKitNetwork, ...AppKitNetwork[]] = [
  {
    id: sepolia.id,
    name: sepolia.name,
    nativeCurrency: sepolia.nativeCurrency,
    rpcUrls: {
      default: {
        http: [sepolia.rpcUrls.default.http[0]],
      },
    },
    blockExplorers: {
      default: {
        name: "Etherscan",
        url: "https://sepolia.etherscan.io",
        apiUrl: "https://api-sepolia.etherscan.io/api",
      },
    },
  },
];

const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId,
  ssr: true
})

createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId,
  metadata: metadataWeb3,
  features: {
    analytics: true
  }
})

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ChakraProvider>
      <WagmiProvider config={wagmiAdapter.wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <Web3ContextProvider>
            {children}
          </Web3ContextProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </ChakraProvider>
  )
}