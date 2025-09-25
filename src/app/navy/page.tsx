'use client'

import React, { useEffect, useState } from 'react'
import { useWeb3Context } from '@/context/Web3Context'
import { useMint } from '@/services/Mint'
import {
    Box,
    Button,
    Card,
    CardBody,
    CardHeader,
    Heading,
    Input,
    Stack,
    Text,
    VStack,
    HStack,
    Spinner,
    useToast,
    Divider,
    Badge,
    Flex
} from '@chakra-ui/react'
import { formatEther } from 'ethers'

const BankDashboard: React.FC = () => {
    const { signer, isConnected } = useWeb3Context()
    const { createMintRequest, navyConfirm, getNeedNavyConfirm } = useMint(signer)

    const [requests, setRequests] = useState([])
    const [loading, setLoading] = useState(false)

    const [form, setForm] = useState({
        user: '',
        amount: '',
    })

    const toast = useToast()

    const loadRequests = async () => {
        setLoading(true)
        try {
            const reqs = await getNeedNavyConfirm()
            setRequests(reqs)
        } catch (e) {
            console.error(e)
        }
        setLoading(false)
    }

    useEffect(() => {
        if (isConnected) loadRequests()
    }, [isConnected])

    const handleCreateRequest = async () => {
        if (!form.user || !form.amount) {
            toast({ status: 'warning', description: 'Please fill in all fields.' })
            return
        }
        try {
            await createMintRequest(form.user, form.amount);
            toast({ status: 'success', description: 'Request created successfully!' })
            setForm({ user: '', amount: '' })
            loadRequests()
        } catch (e) {
            console.error(e)
            toast({ status: 'error', description: 'Failed to create request.' })
        }
    }

    const handleConfirm = async (id: string) => {
        try {
            await navyConfirm(id)
            toast({ status: 'success', description: 'Request confirmed!' })
            loadRequests()
        } catch (e) {
            console.error(e)
            toast({ status: 'error', description: 'Failed to confirm request.' })
        }
    }

    return (
        <Box p={8} bg="gray.50" minH="100vh">
            {/* Header */}
            <Box mb={10}>
                <Flex justify="space-between" alignItems="center">
                    <Box>
                        <Heading size="lg" mb={2}>
                            Navy Dashboard
                        </Heading>
                        <Text color="gray.600">Manage requests and confirmations</Text>
                    </Box>
                    <w3m-button />
                </Flex>
            </Box>

            <Stack direction={{ base: 'column', md: 'row' }} spacing={8} align="flex-start">
                {/* Create Request Form */}
                <Card w={{ base: '100%', md: '40%' }} shadow="lg" borderRadius="2xl">
                    <CardHeader>
                        <Heading size="md">Create Navy Request</Heading>
                    </CardHeader>
                    <CardBody>
                        <VStack spacing={4} align="stretch">
                            <Input
                                placeholder="User wallet address"
                                value={form.user}
                                onChange={(e) => setForm({ ...form, user: e.target.value })}
                            />
                            <Input
                                placeholder="Amount"
                                type="number"
                                value={form.amount}
                                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                            />
                            <Button colorScheme="blue" onClick={handleCreateRequest}>
                                Submit Request
                            </Button>
                        </VStack>
                    </CardBody>
                </Card>

                {/* Requests List */}
                <Card flex="1" shadow="lg" borderRadius="2xl">
                    <CardHeader>
                        <Heading size="md">Pending Requests</Heading>
                    </CardHeader>
                    <CardBody>
                        {loading ? (
                            <Spinner />
                        ) : requests.length === 0 ? (
                            <Text color="gray.500">No requests available.</Text>
                        ) : (
                            <Box maxH="500px" overflowY="auto" pr={2}>
                                <Stack spacing={4}>
                                    {requests.map((req, index) => (
                                        <Box
                                            key={index}
                                            borderWidth="1px"
                                            borderRadius="lg"
                                            p={5}
                                            bg="white"
                                            shadow="sm"
                                            _hover={{ shadow: 'md' }}
                                        >
                                            <HStack justify="space-between">
                                                <Text fontWeight="bold">Request #{req[0]}</Text>
                                                <Badge colorScheme={req[4] ? 'green' : 'yellow'}>
                                                    {req[4] ? 'Confirmed' : 'Pending'}
                                                </Badge>
                                            </HStack>
                                            <Divider my={3} />
                                            <Text>
                                                <b>User:</b> {req[1]}
                                            </Text>
                                            <Text>
                                                <b>Amount:</b>{' '}
                                                {Number(formatEther(req[2])).toLocaleString('vi-VN')} NVD
                                            </Text>
                                            {!req[4] && (
                                                <Button
                                                    mt={4}
                                                    colorScheme="green"
                                                    size="sm"
                                                    onClick={() => handleConfirm(req[0])}
                                                >
                                                    Confirm
                                                </Button>
                                            )}
                                        </Box>
                                    ))}
                                </Stack>
                            </Box>
                        )}
                    </CardBody>
                </Card>
                f
            </Stack>
        </Box>
    )
}

export default BankDashboard
