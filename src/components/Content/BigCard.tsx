import {
  Box,
  Heading,
  HStack,
  Text,
  VStack,
  Divider
} from "@chakra-ui/react";

type CardProps = {
  title: string;
  balance?: number;
  cr?: number | bigint;
  value?: number;
};

export default function InfoCard({ title, balance, cr, value }: CardProps) {
  console.log(value);
  
  return (
    <Box 
      p={6} 
      borderRadius="3xl" 
      bg="#5D4E7B" 
      textColor="white" 
      h="100%" 
      display="flex" 
      flexDirection="column" 
      justifyContent="space-between"
      boxShadow="lg"
    >
      {/* Header */}
      <VStack align="start" spacing={2}>
        <Text 
          textTransform="uppercase" 
          fontSize="lg" 
          fontWeight="bold"
          letterSpacing="wide"
        >
          {title}
        </Text>

        <Heading fontSize="2xl" lineHeight="short">
          {balance !== undefined 
            ? `${balance.toLocaleString("vi-VN")} NVD` 
            : "Please connect wallet"}
        </Heading>
      </VStack>

      <Divider borderColor="gray.300" my={4} />

      {/* Details */}
      <HStack spacing={6} justify="space-between">
        <VStack align="start" spacing={1} w="50%">
          <Text fontSize="sm" color="gray.300">Collateral Ratio</Text>
          <Heading size="md" color={cr && cr < 120 ? "red.400" : "green.300"}>
            {cr !== undefined 
              ? (cr < 1000 ? `${cr.toLocaleString("vi-VN")} %` : "∞") 
              : "—"}
          </Heading>
        </VStack>

        <VStack align="start" spacing={1} w="50%">
          <Text fontSize="sm" color="gray.300">Collateral Value</Text>
          <Heading size="md">
            {value !== undefined 
              ? `${value.toLocaleString("vi-VN")} NVD` 
              : "—"}
          </Heading>
        </VStack>
      </HStack>
    </Box>
  );
}
