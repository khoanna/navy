'use client'

import {
  Box,
  SimpleGrid,
  GridItem,
  Stack,
  Heading,
  Flex
} from "@chakra-ui/react"

import BigCard from "@/components/Content/BigCard"
import Security from "@/components/Content/Security"
import SmallCard from "@/components/Content/SmallCard"
import Transactions from "@/components/Content/Transactions"

import { useWeb3Context } from "@/context/Web3Context"
import { useVault } from "@/services/Vault"
import { useEffect, useState } from "react"
import { formatEther } from "ethers"

export default function App() {
  const { signer, address, isConnected } = useWeb3Context()
  const { getCollateralValue, getCollateralRatio, getPosition } = useVault(signer)

  const [cr, setCr] = useState<number>()
  const [value, setValue] = useState<number>()
  const [NVDminted, setNVDminted] = useState<number>()
  const [WETH, setWETH] = useState<number>()
  const [WBTC, setWBTC] = useState<number>()

  const run = async () => {
    if (address) {
      const cr = await getCollateralRatio(address)
      const value = await getCollateralValue(address)
      const position = await getPosition(address)

      setWETH(Number(formatEther(position[0])))
      setWBTC(Number(formatEther(position[1])))
      setNVDminted(Number(formatEther(position[2])))
      setValue(Number(value))
      setCr(Number(cr))
    }
  }
  
  useEffect(() => {
    run()
  }, [address, isConnected])

  return (
    <Box p={8} bg="gray.50" minH="100vh">
      {/* Header */}
      <Flex justify="space-between" align="center" mb={10}>
        <Heading size="xl" fontWeight="bold">Dashboard</Heading>
        <w3m-button />
      </Flex>

      {/* Main Layout */}
      <SimpleGrid columns={{ base: 1, md: 12 }} gap={6}>

        {/* Left side (8/12) */}
        <GridItem colSpan={{ base: 1, md: 8 }}>
          <SimpleGrid columns={{ base: 1, md: 5 }} gap={6} mb={6}>
            <GridItem colSpan={3}>
              <BigCard
                title="NVD Minted"
                balance={NVDminted}
                cr={cr}
                value={value}
              />
            </GridItem>
            <GridItem colSpan={2}>
              <Stack spacing={6}>
                <SmallCard value="130%" text="Min Collateral Rate" />
                <SmallCard value="110%" text="Liquidation Threshold" />
              </Stack>
            </GridItem>
          </SimpleGrid>

          {/* Transactions */}
          <Transactions isConnected signer={signer} />
        </GridItem>

        {/* Right side (4/12) - Full height */}
        <GridItem colSpan={{ base: 1, md: 4 }} rowSpan={2}>
          <Security WETH={WETH} WBTC={WBTC} signer={signer} />
        </GridItem>
      </SimpleGrid>
    </Box>
  )
}
