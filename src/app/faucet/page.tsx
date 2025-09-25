"use client"

import { useFaucet } from '@/services/Faucet';
import React from 'react';
import { Box, Button, Heading, Stack, Text, useToast } from '@chakra-ui/react';
import { useWeb3Context } from '@/context/Web3Context';

const Faucet = () => {
    const { signer } = useWeb3Context()
    const { claimWBTC, claimWETH } = useFaucet(signer);
    const toast = useToast();

    const handleClaimWBTC = async () => {
        try {
            await claimWBTC();
            toast({
                title: "Success",
                description: "You have claimed WBTC!",
                status: "success",
                duration: 3000,
                isClosable: true,
            });
        } catch (e) {
            toast({
                title: "Error",
                description: "Claim failed",
                status: "error",
                duration: 3000,
                isClosable: true,
            });
        }
    };

    const handleClaimWETH = async () => {
        try {
            await claimWETH();
            toast({
                title: "Success",
                description: "You have claimed WETH!",
                status: "success",
                duration: 3000,
                isClosable: true,
            });
        } catch (e) {
            toast({
                title: "Error",
                description: "Claim failed",
                status: "error",
                duration: 3000,
                isClosable: true,
            });
        }
    };

    return (
        <Box p={8} maxW="md" mx="auto" mt={10} borderWidth={1} borderRadius="lg" shadow="md">
            <Heading mb={6} textAlign="center" justifyItems="center">
                <w3m-button />
            </Heading>
            <Stack spacing={4}>
                <Box>
                    <Text fontSize="lg">Claim test tokens:</Text>
                </Box>

                <Button colorScheme="teal" size="lg" onClick={handleClaimWBTC}>
                    Claim WBTC
                </Button>

                <Button colorScheme="blue" size="lg" onClick={handleClaimWETH}>
                    Claim WETH
                </Button>
            </Stack>
        </Box>
    );
};

export default Faucet;
