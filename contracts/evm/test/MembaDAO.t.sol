// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test, console } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import { MembaDAO } from "../src/core/MembaDAO.sol";
import { MembaDAOFactory } from "../src/core/MembaDAOFactory.sol";

/**
 * @title MembaDAOTest
 * @notice Skeleton tests for MembaDAO + MembaDAOFactory.
 *         Validates that the scaffold compiles and basic deployment works.
 *
 * TODO: Expand with full governance lifecycle tests per MembaDAO.spec.md
 */
contract MembaDAOTest is Test {
    MembaDAO public daoImpl;
    MembaDAOFactory public factory;

    address public admin = makeAddr("admin");
    address public member1 = makeAddr("member1");
    address public member2 = makeAddr("member2");

    function setUp() public {
        // Deploy implementation
        daoImpl = new MembaDAO();

        // Deploy factory
        factory = new MembaDAOFactory(address(daoImpl));
    }

    function test_ImplementationCannotBeInitializedDirectly() public {
        vm.expectRevert();
        daoImpl.initialize("Test DAO", "A test DAO", admin);
    }

    function test_FactoryDeploysDAO() public {
        address dao = factory.createDAO("Test DAO", "A test DAO", admin, bytes32(uint256(1)));
        assertTrue(dao != address(0), "DAO address should not be zero");
        assertEq(factory.daoCount(), 1, "DAO count should be 1");
        assertEq(factory.daos(0), dao, "DAO should be stored at index 0");
    }

    function test_FactoryDeploysDeterministic() public {
        bytes32 salt = bytes32(uint256(42));
        address dao1 = factory.createDAO("DAO 1", "First DAO", admin, salt);
        // Same name + description + admin + salt = same init code + salt → CREATE2 collision → revert
        vm.expectRevert();
        factory.createDAO("DAO 1", "First DAO", admin, salt);
        assertTrue(dao1 != address(0));
    }

    function test_DAOVersion() public {
        address dao = factory.createDAO("Test DAO", "A test DAO", admin, bytes32(uint256(99)));
        assertEq(MembaDAO(dao).version(), "1.0.0");
    }

    function test_FactoryVersion() public view {
        assertEq(factory.version(), "1.0.0");
    }

    function test_FactoryRejectsZeroImplementation() public {
        vm.expectRevert(MembaDAOFactory.InvalidImplementation.selector);
        new MembaDAOFactory(address(0));
    }

    function test_OnlyOwnerCanSetImplementation() public {
        MembaDAO newImpl = new MembaDAO();
        vm.prank(member1);
        vm.expectRevert();
        factory.setImplementation(address(newImpl));
    }
}
