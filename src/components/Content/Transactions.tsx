"use client"

import { useNVD } from "@/services/NVD"
import { useVault } from "@/services/Vault"
import { Box, Flex, Heading, Input, Button, Stack, Text } from "@chakra-ui/react"
import { JsonRpcSigner } from "ethers"
import { useState } from "react"

export default function MintAndBurn({ isConnected, signer }: { isConnected: boolean, signer?: JsonRpcSigner }) {
  const [mintAmount, setMintAmount] = useState("")
  const [repayAmount, setRepayAmount] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<"mint" | "repay" | null>(null)

  const { mintNVD, repayNVD } = useVault(signer);
  const { approve } = useNVD(signer);

  const handleMint = async () => {
    try {
      setError(null)
      setLoading("mint")
      if (!mintAmount || Number(mintAmount) <= 0) throw new Error("Invalid mint amount")
      await mintNVD(mintAmount);
      console.log("Minting:", mintAmount)
    } catch (e) {
      setError("Mint failed")
    } finally {
      setLoading(null)
    }
  }

  const handleRepay = async () => {
    try {
      setError(null)
      setLoading("repay")
      if (!repayAmount || Number(repayAmount) <= 0) throw new Error("Invalid repay amount")
      await approve(repayAmount)
      await repayNVD(repayAmount);
      console.log("Repaying:", repayAmount)
    } catch (e) {
      setError("Repay failed")
    } finally {
      setLoading(null)
    }
  }

  return (
    <Box>
      <Flex gap={10} justify="center" flexWrap="wrap">
        {/* Mint Box */}
        <Box
          p={8}
          rounded="2xl"
          shadow="xl"
          w="sm"
          textAlign="center"
          _hover={{ transform: "translateY(-4px)", shadow: "2xl" }}
          transition="all 0.3s"
        >
          <Heading size="md" mb={6} color="teal.600">
            Mint
          </Heading>
          <Stack spacing={4}>
            <Input
              placeholder="Amount"
              type="number"
              value={mintAmount}
              onChange={(e) => setMintAmount(e.target.value)}
              focusBorderColor="teal.400"
              rounded="xl"
              size="lg"
            />
            <Button
              onClick={handleMint}
              isLoading={loading === "mint"}
              colorScheme="teal"
              size="lg"
              rounded="xl"
              fontWeight="semibold"
              _hover={{ transform: "scale(1.05)" }}
              transition="all 0.2s"
              disabled={!isConnected}
            >
              {isConnected ? "Mint" : "—"}
            </Button>
          </Stack>
        </Box>

        {/* Repay Box */}
        <Box
          bgGradient="linear(to-br, red.50, white)"
          p={8}
          rounded="2xl"
          shadow="xl"
          w="sm"
          textAlign="center"
          _hover={{ transform: "translateY(-4px)", shadow: "2xl" }}
          transition="all 0.3s"
        >
          <Heading size="md" mb={6} color="red.500">
            Repay
          </Heading>
          <Stack spacing={4}>
            <Input
              placeholder="Amount"
              type="number"
              value={repayAmount}
              onChange={(e) => setRepayAmount(e.target.value)}
              focusBorderColor="red.400"
              rounded="xl"
              size="lg"
            />
            <Button
              onClick={handleRepay}
              isLoading={loading === "repay"}
              colorScheme="red"
              size="lg"
              rounded="xl"
              fontWeight="semibold"
              _hover={{ transform: "scale(1.05)" }}
              transition="all 0.2s"
              disabled={!isConnected}
            >
              {isConnected ? "Repay" : "—"}
            </Button>
          </Stack>
        </Box>
      </Flex>

      {/* Hiển thị lỗi */}
      {error && (
        <Text mt={6} textAlign="center" color="red.500" fontWeight="semibold">
          ⚠ {error}
        </Text>
      )}
    </Box>
  )
}
