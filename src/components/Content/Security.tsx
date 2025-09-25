"use client"

import { useVault } from "@/services/Vault"
import { useWBTC } from "@/services/WBTC"
import { useWETH } from "@/services/WETH"
import {
  Box,
  Flex,
  Heading,
  Input,
  Button,
  Stack,
  Text,
  Icon
} from "@chakra-ui/react"
import { JsonRpcSigner } from "ethers"
import { useState } from "react"
import { FaBitcoin, FaEthereum } from "react-icons/fa"
import { IconType } from "react-icons/lib"

interface TokenCardProps {
  name: string;
  symbol: string;
  icon: IconType;
  color?: string;
  balance?: number | string;
}

export default function DepositWithdraw(balance: { WBTC?: number, WETH?: number, signer?: JsonRpcSigner }) {
  const [amounts, setAmounts] = useState<{ [key: string]: string }>({
    WBTC: "",
    WETH: ""
  })

  const { approveWBTC } = useWBTC(balance.signer);
  const { approveWETH } = useWETH(balance.signer);
  const { depositWBTC, depositWETH, redeemWBTC, redeemWETH } = useVault(balance.signer)

  const handleChange = (symbol: string, value: string) => {
    setAmounts(prev => ({ ...prev, [symbol]: value }))
  }

  const handleDeposit = async (symbol: string) => {
    if (symbol === "WBTC") {
      await approveWBTC(amounts.WBTC)
      await depositWBTC(amounts.WBTC)
    } else if (symbol === "WETH") {
      await approveWETH(amounts.WETH)
      await depositWETH(amounts.WETH)
    }
  }

  const handleRedeem = async (symbol: string) => {
    if (symbol === "WBTC") {
      await redeemWBTC(amounts.WBTC)
    } else if (symbol === "WETH") {
      await redeemWETH(amounts.WETH)
    }
  }

  const TokenCard = ({ name, symbol, icon, color, balance }: TokenCardProps) => (
    <Box
      p={8}
      rounded="2xl"
      shadow="xl"
      w="sm"
      textAlign="center"
      _hover={{ transform: "translateY(-4px)", shadow: "2xl" }}
      transition="all 0.3s"
      bg="white"
    >
      <Flex align="center" justify="center" mb={4} gap={3}>
        <Icon as={icon} boxSize={7} color={color} />
        <Heading size="md" color="gray.700">
          {name}
        </Heading>
      </Flex>

      <Text fontSize="sm" color="gray.500" mb={4}>
        Collateral Amount:{" "}
        <b>{balance !== undefined ? balance : "—"} {symbol}</b>
      </Text>

      <Stack spacing={4}>
        <Input
          placeholder="Amount"
          type="number"
          value={amounts[symbol]}
          onChange={(e) => handleChange(symbol, e.target.value)}
          rounded="xl"
          size="lg"
          focusBorderColor="teal.400"
        />
        <Flex gap={3}>
          <Button
            flex={1}
            colorScheme="teal"
            size="lg"
            rounded="xl"
            fontWeight="semibold"
            _hover={{ transform: "scale(1.05)" }}
            transition="all 0.2s"
            onClick={() => handleDeposit(symbol)}
          >
            Deposit
          </Button>
          <Button
            flex={1}
            colorScheme="red"
            size="lg"
            rounded="xl"
            fontWeight="semibold"
            _hover={{ transform: "scale(1.05)" }}
            transition="all 0.2s"
            onClick={() => handleRedeem(symbol)}
          >
            Redeem
          </Button>
        </Flex>
      </Stack>
    </Box>
  )

  return (
    <Box>
      <Flex gap={10} justify="center" flexWrap="wrap">
        <TokenCard
          name="Bitcoin"
          symbol="WBTC"
          icon={FaBitcoin}
          color="orange.400"
          balance={balance.WBTC}
        />
        <TokenCard
          name="Ethereum"
          symbol="WETH"
          icon={FaEthereum}
          color="blue.400"
          balance={balance.WETH}
        />
      </Flex>
    </Box>
  )
}
