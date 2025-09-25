"use client";

import {
  Box,
  Flex,
  Heading,
  Spacer,
  Stack,
  Text,
} from "@chakra-ui/react";
import { FaEthereum, FaBitcoin } from "react-icons/fa";

type WalletCardProps = {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  amount: string | number | undefined;
  color1: string;
  color2: string;
};

const WalletCard = ({
  icon,
  title,
  subtitle,
  amount,
  color1,
  color2,
}: WalletCardProps) => (
  <Box
    bg="white"
    p={4}
    borderRadius="xl"
    shadow="md"
    _hover={{ shadow: "lg", transform: "translateY(-2px)" }}
    transition="all 0.2s"
  >
    <Flex align="center">
      <Box
        borderRadius="lg"
        fontSize="2xl"
        p={3}
        bg={color1}
        color={color2}
      >
        {icon}
      </Box>

      <Box ml={3}>
        <Heading fontSize="md">{title}</Heading>
        <Text fontSize="sm" color="gray.500">
          {subtitle}
        </Text>
      </Box>

      <Spacer />

      <Box textAlign="right">
        <Text fontSize="lg" fontWeight="semibold">
          {amount}
        </Text>
      </Box>
    </Flex>
  </Box>
);

export default function WalletList({ BTC, ETH }: { BTC?: number, ETH?: number }) {
  return (
    <Box px={6} py={4}>
      <Text
        mb={3}
        textColor="gray.500"
        fontSize="sm"
        fontWeight="medium"
      >
        Your Position
      </Text>

      <Stack spacing={3}>
        <WalletCard
          title="BTC"
          subtitle="Bitcoin"
          icon={<FaBitcoin />}
          amount={typeof BTC !== undefined ? BTC : "—"}
          color1="#FFECE8"
          color2="#FE8F7B"
        />
        <WalletCard
          title="ETH"
          subtitle="Ethereum"
          icon={<FaEthereum />}
          amount={typeof ETH !== undefined ? ETH : "—"}
          color1="#E0F4F8"
          color2="#43B8D5"
        />
      </Stack>
    </Box>
  );
}
