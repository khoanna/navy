import { Box, Heading, Text } from "@chakra-ui/react";


export default function SmallCard ({ value, text }: { value: string, text: string })  {
  return (
    <Box p={6} bg="#DBE3E5" borderRadius="3xl">
      <Heading fontWeight="light" fontSize="2xl">
        {value}
      </Heading>
      <Text mt={4}>{text}</Text>
    </Box>
  );
};
